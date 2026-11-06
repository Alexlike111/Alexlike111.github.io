import './ui.css';
import type { Input } from './input';
import { Wheel, type WheelItem } from './wheel';
import { plural } from './ru';

export interface HudData {
  core: number; food: number; stamina: number; wet: number;   // core °C; others 0..1
  airT: number; feelT: number; wind: number; shelter: number;  // wind m/s signed at player; shelter 0..1
  day: number; clock: string; night: boolean; warning: string | null;
  tool: number; tools: { id: string; name: string; key: string; count?: number; enabled: boolean }[]; // ids: shovel, saw, axe, beam, block, fire
  inv: { logs: number; branches: number; matches: number; food: number; blocks: number; snowshoes: boolean; thermos: number };
  hint: string | null;
  waiting: boolean;
  // live readouts (tools.ts toolHud)
  fire: { fuel: number; lit: boolean; d: number; near: boolean } | null; // nearest campfire; fuel in game minutes; near = within the 2 m feed radius
  sawP: number;       // share of the current cut done, 0..1
  beamMode: string;   // beam shape name, e.g. «брус 1 м»
  digP: number;       // shovel: progress of the tile being dug, 0..1 (0 = not digging)
  encl: Enclosure;    // the air pocket the hero stands in (main.ts enclosureAt, 4 Hz)
}
/** closed: the air pocket reaches no open sky; open: it does (ang = degrees, screen axes, toward the nearest opening, null when standing in it);
 *  big: the pocket is larger than the search cap and no sky was reached; none: the hero's cell is solid (no reading) */
export interface Enclosure { st: 'closed' | 'open' | 'big' | 'none'; ang: number | null }

/** campfire fuel bar scale: 4 game hours = full */
const FIRE_FULL_MIN = 240;
/** campfire fuel as the player reads it: «~3 ч», «~40 мин», «потух», «прогорел» */
function fireText(f: NonNullable<HudData['fire']>): string {
  if (f.fuel <= 0) return 'прогорел';
  if (!f.lit) return 'потух';
  if (f.fuel >= 60) return `~${Math.round(f.fuel / 60)} ч`;
  return `~${Math.max(1, Math.round(f.fuel))} мин`;
}

// ---------------------------------------------------------------- icons
// Hand-drawn 24×24 line icons (stroke = currentColor). Deliberately a little uneven.
const ICONS: Record<string, string> = {
  shovel: '<g stroke-width="1.75"><g transform="translate(18.4 5.2) rotate(135)"><path d="M0 -2.6C-4.4 -2.6 -4.4 2.6 0 2.6Z" fill="currentColor" fill-opacity=".14"/><path d="M0 0H9.6" stroke-width="2"/><path d="M9.4 -3.2L13.4 -4.9Q18.2 -5.3 18.2 0Q18.2 5.3 13.4 4.9L9.4 3.2Z" fill="currentColor" fill-opacity=".22"/><path d="M11.6 0H16.4" stroke-width="1.1" opacity=".65"/></g></g>',
  saw: '<g stroke-width="1.75"><g transform="translate(2 18.7) rotate(-35)"><rect x="1.6" y="-3.6" width="5" height="5.6" rx="1.8" fill="currentColor" fill-opacity=".14"/><path d="M6.6 -2.4H20.4L22.6 0.2L21.4 2.2H6.6Z" fill="currentColor" fill-opacity=".2"/><path d="M7.2 2.2L8.8 4.1L10.4 2.2L12 4.1L13.6 2.2L15.2 4.1L16.8 2.2L18.4 4.1L20 2.2"/></g></g>',
  axe: '<g stroke-width="1.75"><g transform="translate(-1.5 0.5) rotate(38 12 12)"><path d="M11.7 22.4C10.8 17 11.5 12.4 11.8 7"/><path d="M7.6 4.6Q7.6 3.1 9.2 3.1L18.6 2.6Q21.6 4.2 21.4 6.6Q21.2 9.6 16.2 11.2L12.8 10.2L9.2 10.4Q7.6 10.4 7.6 8.8Z" fill="currentColor" fill-opacity=".22"/><path d="M10.2 5.2H12.6V8.6H10.2Z" stroke-width="1.1" opacity=".75"/><path d="M18.8 5C20.3 5.8 20.6 8 19.6 9.4" stroke-width="1.1" opacity=".6"/></g></g>',
  beam: '<g stroke-width="1.75"><path d="M17.5 6.2H4.6Q2.8 12 4.6 17.8H17.5Z" fill="currentColor" fill-opacity=".18"/><path d="M6.4 9.6H10.2M9.6 14.6H13.4" stroke-width="1.2" opacity=".6"/><ellipse cx="17.5" cy="12" rx="2.9" ry="5.8" fill="currentColor" fill-opacity=".3"/><ellipse cx="17.5" cy="12" rx="1.6" ry="3.2" stroke-width="1.1" opacity=".7"/><ellipse cx="17.5" cy="12" rx=".6" ry="1" fill="currentColor" stroke-width="1"/></g>',
  door: '<g stroke-width="1.75"><rect x="5.5" y="3" width="13" height="18" rx="1.2" fill="currentColor" fill-opacity=".18"/><path d="M9.8 3V21M14.2 3V21" stroke-width="1.2" opacity=".7"/><path d="M5.5 8.2H18.5M5.5 15.8H18.5" stroke-width="1.2" opacity=".7"/><circle cx="15.8" cy="12" r=".9" fill="currentColor" stroke-width="1"/></g>',
  block: '<g stroke-width="1.75"><path d="M12 2.8L21.2 7.6L12 12.4L2.8 7.6Z" fill="currentColor" fill-opacity=".3"/><path d="M2.8 7.6L12 12.4V21.4L2.8 16.6Z" fill="currentColor" fill-opacity=".14"/><path d="M12 12.4L21.2 7.6V16.6L12 21.4Z" fill="currentColor" fill-opacity=".05"/><path d="M4.2 12.8L10.6 16.2M14 15.9L19.6 12.95" stroke-width="1.2" opacity=".65"/></g>',
  fire: '<g stroke-width="1.75"><path d="M5.2 21L10.8 5.6M18.8 21L13.2 5.6"/><path d="M3.8 21.2H20.2"/><path d="M12 9.4C13.6 11.6 15.6 13.2 15.4 15.6C15.2 17.4 13.8 18.2 12 18.2C10.2 18.2 8.8 17.4 8.6 15.6C8.5 13.9 9.6 12.8 10.2 11.4C10.8 12.3 11.2 12.7 11.7 12.9C11.4 11.5 11.2 10.5 12 9.4Z" fill="currentColor" fill-opacity=".25"/><path d="M12 14.6C12.8 15.6 13.4 16.2 13.1 17C12.9 17.5 11.1 17.5 10.9 17C10.6 16.2 11.2 15.6 12 14.6Z" fill="currentColor" fill-opacity=".7" stroke-width="1"/></g>',
  branches: '<path d="M3.5 20.3L20 5"/><path d="M9.6 14.6l-.8-4.9M13.8 10.8l5.3.8M7 17l-3.3-.7M16 8l.4-3.4"/>',
  matches: '<path d="M5 20L16.3 5.6M10 20l9.5-12"/><circle cx="17.2" cy="4.6" r="1.9"/><circle cx="20.5" cy="6.6" r="1.7"/>',
  food: '<path d="M5 8.2c0-1.2 3.1-2.2 7-2.2s7 1 7 2.2v8.4c0 1.2-3.1 2.2-7 2.2s-7-1-7-2.2z"/><path d="M5 8.2c0 1.2 3.1 2.2 7 2.2s7-1 7-2.2"/><path d="M5.2 13.2c1.7 1 4 1.4 6.8 1.4s5.100-.4 6.800-1.400" opacity=".6"/>',
  snowshoes: '<ellipse cx="12" cy="12" rx="5.2" ry="9.2" transform="rotate(25 12 12)"/><path d="M7.9 6.9l8.200 10.300M16.100 6.900L7.900 17.200M10 4.800l7.600 9.600M6.400 9.600l7.600 9.600" opacity=".65"/>',
  thermos: '<path d="M8.200 6.500h7.600v13a1.600 1.600 0 0 1-1.600 1.600H9.800a1.600 1.600 0 0 1-1.600-1.600z"/><path d="M9 6.500V4.200h6v2.300M8.200 10h7.600"/>',
  put: '<path d="M12 3.800v9.500M7.700 9.300l4.300 4.300 4.300-4.300"/><path d="M4.500 18.800h15M7 20.800h10" />',
  take: '<path d="M12 14.500V4.200M7.700 8.500L12 4.200l4.300 4.300"/><path d="M4.500 18.800h15M7 20.800h10"/>',
  eat: '<path d="M7.200 3v6.200c0 1.600 1 2.800 2.600 2.900V21M5 3v5.600M9.600 3v5.600"/><path d="M16.800 21V3.200c-2.200 1-3.200 3.700-3.200 6.500 0 1.700.8 2.600 2 2.800"/>',
  wait: '<path d="M6.800 3h10.400M6.800 21h10.400M7.800 3.300c0 4.600 8.400 4.800 8.400 8.700s-8.400 4.100-8.400 8.700M16.200 3.300c0 4.600-8.400 4.800-8.400 8.700s8.400 4.100 8.400 8.700"/>',
  rotate: '<path d="M19.200 8.300A8 8 0 1 0 20 14"/><path d="M19.600 3.200v5.300h-5.300"/>',
  xray: '<path d="M2.500 12S6 6 12 6s9.500 6 9.500 6-3.500 6-9.500 6-9.500-6-9.500-6z"/><circle cx="12" cy="12" r="2.800"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  unfull: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  sound: '<path d="M4 9.500h3.200L12 5.500v13l-4.800-4H4z"/><path d="M15.500 9a4.200 4.200 0 0 1 0 6M18 6.500a7.600 7.600 0 0 1 0 11"/>',
  mute: '<path d="M4 9.500h3.200L12 5.500v13l-4.800-4H4z"/><path d="M16 9.500l5 5M21 9.500l-5 5"/>',
  bolt: '<path d="M13.500 2.800L6 13.200h5.200l-1.100 8 7.900-11h-5.500z"/>',
  drop: '<path d="M12 2.800c3.200 4.400 6.200 7.400 6.200 11a6.200 6.200 0 0 1-12.400 0c0-3.600 3-6.600 6.200-11z"/><path d="M9 14.600a3.200 3.200 0 0 0 2.400 2.800" opacity=".7"/>',
  hut: '<path d="M2.800 12.200L12 4l9.200 8.200"/><path d="M5.800 10.800V20h12.400v-9.200"/><path d="M10 20v-5.200h4V20"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.500v3M12 18.500v3M2.500 12h3M18.500 12h3M5.300 5.300l2.100 2.100M16.600 16.600l2.100 2.100M18.700 5.300l-2.100 2.100M7.400 16.600l-2.100 2.100"/>',
  moon: '<path d="M19.500 14.800A8 8 0 0 1 9.200 4.500a8 8 0 1 0 10.300 10.300z"/>',
  baro: '<path d="M4 17a8 8 0 0 1 16 0"/><path d="M12 17l-3.500-5.200"/><path d="M6 13.500l1 .6M18 13.500l-1 .6M12 8.500v1.100"/><path d="M5 20.500h14"/>',
  phone: '<rect x="6" y="2.500" width="12" height="19" rx="2.200"/><path d="M10.500 18.500h3"/>',
  flask: '<path d="M9.500 3h5M10.500 3v6L5 19.200c-.5 1 .2 1.800 1.200 1.800h11.600c1 0 1.700-.8 1.200-1.800L13.500 9V3"/><path d="M7.800 15h8.400" opacity=".7"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  stick: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.400"/><path d="M12 4.200V6M12 18v1.800M4.200 12H6M18 12h1.800" opacity=".6"/>',
  pad: '<circle cx="7.500" cy="7.500" r="3.100"/><circle cx="16.500" cy="7.500" r="3.100"/><circle cx="7.500" cy="16.500" r="3.100"/><circle cx="16.500" cy="16.500" r="3.100"/>',
  jump: '<path d="M12 20V5.500M6.200 11.200L12 5.400l5.800 5.800"/><path d="M7 22h10" opacity=".55"/>',
  swap: '<path d="M4 8.500h14.500M15 4.800l3.700 3.700-3.700 3.700"/><path d="M20 15.500H5.500M9 11.800l-3.700 3.700L9 19.200"/>',
  timer: '<circle cx="12" cy="13.600" r="7.200"/><path d="M12 13.600V9.400M12 13.600l3 1.800M9.600 3.200h4.800M12 3.200v3.200M18.300 6.600l1.300-1.300"/>',
  copy: '<rect x="8.500" y="8.500" width="11.500" height="12" rx="1.600"/><path d="M15.500 8.500V5.200a1.600 1.600 0 0 0-1.600-1.600H5.700a1.600 1.600 0 0 0-1.600 1.600v9.700a1.600 1.600 0 0 0 1.600 1.600h2.800"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.800"/>',
};

/** caption forms for counted HUD chips: [one, few, many] */
const CHIP_WORDS: Record<string, [string, string, string]> = {
  logs: ['бревно', 'бревна', 'брёвен'], matches: ['спичка', 'спички', 'спичек'], blocks: ['блок', 'блока', 'блоков'],
  branches: ['хворост', 'хвороста', 'хвороста'], thermos: ['термос', 'термоса', 'термосов'],
};
export function ico(name: string, cls = ''): string {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] ?? ''}</svg>`;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const MINUS = '−';
const fmtDeg = (v: number) => { const r = Math.round(v); return (r < 0 ? MINUS : r > 0 ? '' : '') + Math.abs(r) + '°'; };
const fmtCore = (v: number) => v.toFixed(1).replace('.', ',');

// ---------------------------------------------------------------- thermometer geometry
const T_MIN = 28, T_MAX = 38;
const TY0 = 214, TY1 = 26; // y of 28 and 38 in the SVG
const tY = (t: number) => TY0 - ((clamp(t, T_MIN, T_MAX) - T_MIN) / (T_MAX - T_MIN)) * (TY0 - TY1);

function thermoSVG(): string {
  let ticks = '';
  for (let i = 0; i <= 20; i++) {
    const t = T_MIN + i * 0.5, y = tY(t).toFixed(1), major = i % 2 === 0;
    ticks += `<line x1="43" x2="${major ? 52 : 47.5}" y1="${y}" y2="${y}" class="${major ? 'tk-major' : 'tk-minor'}"/>`;
    if (major && (t % 2 === 0)) ticks += `<text x="56" y="${(+y + 3.6).toFixed(1)}" class="tk-num">${t}</text>`;
  }
  const y35 = tY(35).toFixed(1), y366 = tY(36.6).toFixed(1);
  return `
  <svg class="thermo-svg" viewBox="-28 0 112 252" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="gl-glass" x1="0" x2="1"><stop offset="0" stop-color="var(--glass-lo)"/><stop offset=".45" stop-color="var(--glass-hi)"/><stop offset="1" stop-color="var(--glass-lo)"/></linearGradient>
    </defs>
    <rect x="29" y="${y35}" width="10" height="${(TY0 - +y35 + 4).toFixed(1)}" class="cold-band"/>
    <path class="tube" d="M29 31A5 5 0 0 1 39 31V215.100A14 14 0 1 1 29 215.100Z" fill="url(#gl-glass)"/>
    <rect id="merc" class="merc" x="32" y="120" width="4" height="120" rx="2"/>
    <circle id="merc-bulb" class="merc-bulb" cx="34" cy="229" r="10.500"/>
    <path class="tube-hi" d="M31.600 34V210"/>
    ${ticks}
    <g class="mark mark-35"><line x1="13" x2="27" y1="${y35}" y2="${y35}"/><text x="11" y="${(+y35 + 3.6).toFixed(1)}">35</text></g>
    <g class="mark mark-366"><line x1="13" x2="27" y1="${y366}" y2="${y366}"/><text x="11" y="${(+y366 + 3.6).toFixed(1)}">36,6</text></g>
    <text x="34" y="14" class="tk-unit" text-anchor="middle">°C</text>
  </svg>`;
}

function dialSVG(): string {
  const cx = 60, cy = 60;
  const ang = (v: number) => 135 + (v / 30) * 270;
  const pt = (a: number, r: number) => `${(cx + Math.cos((a * Math.PI) / 180) * r).toFixed(2)} ${(cy + Math.sin((a * Math.PI) / 180) * r).toFixed(2)}`;
  let ticks = '';
  for (let v = 0; v <= 30; v++) {
    const a = ang(v), major = v % 5 === 0;
    const [x1, y1] = pt(a, major ? 38 : 42).split(' '), [x2, y2] = pt(a, 47).split(' ');
    ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${major ? 'dk-major' : 'dk-minor'}${v >= 18 ? ' dk-hot' : ''}"/>`;
    if (v % 10 === 0) { const [tx, ty] = pt(a, 30).split(' '); ticks += `<text x="${tx}" y="${(+ty + 3).toFixed(1)}" class="dk-num" text-anchor="middle">${v}</text>`; }
  }
  const arc = (a0: number, a1: number, r: number) => `M${pt(a0, r)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${pt(a1, r)}`;
  return `
  <svg class="dial-svg" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
    <circle cx="60" cy="60" r="57" class="dial-bezel"/>
    <circle cx="60" cy="60" r="52" class="dial-face"/>
    <path d="${arc(ang(18), ang(30), 50)}" class="dial-zone"/>
    ${ticks}
    <text x="60" y="33" class="dial-cap" text-anchor="middle">ВЕТЕР</text>
    <g id="dial-dir" class="dial-dir"><path d="M49 52.500h22M65.500 48.500l5.500 4-5.500 4"/></g>
    <g id="dial-needle" class="dial-needle"><path d="M-9 0H41" class="nd-line"/><path d="M41 0l-8-2.600v5.200z" class="nd-tip"/><circle r="4.600" class="nd-hub"/><circle r="1.600" class="nd-pin"/></g>
    <text id="dial-val" x="60" y="94" class="dial-val" text-anchor="middle">0</text>
    <text x="60" y="104" class="dial-unit" text-anchor="middle">м/с</text>
  </svg>`;
}

// ---------------------------------------------------------------- UI
interface Gauge { root: HTMLElement; val: HTMLElement; num: HTMLElement }
type Cached<T extends HTMLElement = HTMLElement> = T & { _t?: string };

const TOOL_ICON: Record<string, string> = { shovel: 'shovel', saw: 'saw', axe: 'axe', beam: 'beam', block: 'block', fire: 'fire' };
/** the icon a tool shows now: the beam in «дверь» mode shows a planked door */
function toolIconName(id: string, beamMode = ''): string { return id === 'beam' && beamMode.startsWith('дверь') ? 'door' : (TOOL_ICON[id] ?? 'block'); }

// built structure ids (tool.built) -> Russian names for the end card
const BUILT_NAME: Record<string, string> = {
  fire: 'Костёр', snow: 'Снежные блоки', wood: 'Брёвна и брус', dugout: 'Землянка', igloo: 'Иглу', cabin: 'Дом',
};

// x-ray legend strip. The colour ramps are the same functions the shader uses (render.ts xrTurbo / xrInferno / xrTemp).
type RGB = [number, number, number];
const c01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
function xrTurbo(x: number): RGB {
  x = c01(x);
  const x2 = x * x, x3 = x2 * x, x4 = x2 * x2, x5 = x4 * x;
  return [
    0.13572138 + 4.6153926 * x - 42.66032258 * x2 + 132.13108234 * x3 - 152.94239396 * x4 + 59.28637943 * x5,
    0.09140261 + 2.19418839 * x + 4.84296658 * x2 - 14.18503333 * x3 + 4.27729857 * x4 + 2.82956604 * x5,
    0.1066733 + 12.64194608 * x - 60.58204836 * x2 + 110.36276771 * x3 - 89.90310912 * x4 + 27.34824973 * x5,
  ].map(c01) as RGB;
}
function xrInferno(t: number): RGB {
  t = c01(t);
  const C = [[0.0002189403691192265, 0.001651004631001012, -0.01948089843709184], [0.1065134194856116, 0.5639564367884091, 3.932712388889277],
    [11.60249308247187, -3.972853965665698, -15.9423941062914], [-41.70399613139459, 17.43639888205313, 44.35414519872813],
    [77.162935699427, -33.40235894210092, -81.80730925738993], [-71.31942824499214, 32.62606426397723, 73.20951985803202],
    [25.13112622477341, -12.24266895238567, -23.07032500287172]];
  return [0, 1, 2].map((k) => c01(C[0][k] + t * (C[1][k] + t * (C[2][k] + t * (C[3][k] + t * (C[4][k] + t * (C[5][k] + t * C[6][k]))))))) as RGB;
}
function xrTemp(t: number): RGB {
  const A: RGB = [.20, .12, .60], B: RGB = [.16, .45, .95], C: RGB = [.35, .85, .95], D: RGB = [.93, .97, 1], E: RGB = [1, .80, .30], F: RGB = [.95, .22, .12];
  const mix = (p: RGB, q: RGB, k: number): RGB => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k];
  if (t < .3) return mix(A, B, t / .3);
  if (t < .6) return mix(B, C, (t - .3) / .3);
  if (t < .78) return mix(C, D, (t - .6) / .18);
  if (t < .84) return mix(D, E, (t - .78) / .06);
  return mix(E, F, (t - .84) / .16);
}
interface XrayDef { title: string; name: string; ramp: (u: number) => RGB; ticks: { at: number; text: string; edge?: 'l' | 'r'; mark?: boolean }[] }
const XRAY: Record<number, XrayDef> = {
  1: { title: 'Плотность, кг/м³', name: 'плотность', ramp: (u) => xrTurbo(.08 + .84 * u),
    ticks: [{ at: 0, text: '50', edge: 'l' }, { at: 1 / 3, text: '200' }, { at: 2 / 3, text: '350' }, { at: 1, text: '500', edge: 'r' }] },
  2: { title: 'Спекание снега', name: 'спекание', ramp: (u) => xrInferno(.10 + .82 * u),
    ticks: [{ at: 0, text: 'рыхлый', edge: 'l' }, { at: Math.sqrt(48 / 160), text: 'контур', mark: true }, { at: 1, text: 'спёкся', edge: 'r' }] },
  3: { title: 'Температура, °C', name: 'температура', ramp: xrTemp,
    ticks: [{ at: 0, text: '−40', edge: 'l' }, { at: 0.4, text: '−20' }, { at: 0.8, text: '0', mark: true }, { at: 1, text: '+10', edge: 'r' }] },
};
const xrGradient = (d: XrayDef) => 'linear-gradient(90deg,' + Array.from({ length: 13 }, (_, i) => { const c = d.ramp(i / 12); return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)}) ${(i / 12 * 100).toFixed(1)}%`; }).join(',') + ')';
const XR_TOAST = ['Рентген выкл.', 'Рентген 1/3 · плотность', 'Рентген 2/3 · спекание снега', 'Рентген 3/3 · температура'];

const TOOL_SUB: Record<string, string> = {
  shovel: 'копать плитки, ПКМ — утрамбовать', saw: 'пилить снежные блоки', axe: 'рубить деревья', beam: 'строить из брёвен', block: 'ставить блоки', fire: 'разжечь костёр',
};

export class UI {
  onSound: (on: boolean) => void = () => {};
  onVolume: (v: number) => void = () => {};
  /** persisted master volume 0..1 (localStorage, try/catch) */
  volume = ((): number => { try { const v = parseFloat(localStorage.getItem('frost.vol') ?? ''); return isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8; } catch { return 0.8; } })();
  private hungerToast = false;
  /** pause-screen physics lab: drop 40 test bodies */
  onStress: () => void = () => {};
  /** «Тест производительности» (title card / pause menu); the argument says where it was pressed */
  onBench: (fromPause: boolean) => void = () => {};

  private root: HTMLElement;
  private input: Input;
  private hud: HTMLElement;
  private memo: Record<string, string | number | boolean> = {};
  private last = 0;
  private soundOn = true;
  private overlay: HTMLElement | null = null;
  private physInfo = '';
  private physEls: { info: HTMLElement } | null = null;
  private xrayEl!: HTMLElement;
  private xrayMode = 0;
  private beatEl: HTMLElement | null = null;
  private gaugeQ = { food: 1, stamina: 1, wet: 0, shelter: 0 };
  private retUntil = 0;
  private warnTime!: Cached;
  private enclChip!: HTMLElement;   // «Укрытие: закрыто ✓» under the УКРЫТИЕ gauge
  private enclTxt!: Cached;
  private enclArr!: SVGElement;
  private toasts!: HTMLElement;
  private hintCard: HTMLElement;
  private hintText: HTMLElement;
  private hudTc!: HTMLElement;
  private chipsTid = 0;
  private hintTid = 0;
  private compactMQ: MediaQueryList | null = null;
  private warnLine!: Cached;
  private warnText!: Cached;
  private reticleEl: HTMLElement;
  private mercCold = [93, 180, 255];
  private mercWarm = [240, 71, 58];

  private mercury!: SVGElement;
  private mercuryBulb!: SVGElement;
  private coreVal!: Cached;
  private coreState!: Cached;
  private thermo!: HTMLElement;
  private gauges: Record<'food' | 'stamina' | 'wet' | 'shelter', Gauge> = {} as never;
  private needle!: SVGElement;
  private dialDir!: SVGElement;
  private dialVal!: SVGElement;
  private feel!: Cached;
  private air!: Cached;
  private feelRow!: HTMLElement;
  private clockDay!: Cached;
  private clockTime!: Cached;
  private clockIcon!: HTMLElement;
  private clockWait!: HTMLElement;
  private chips: Record<string, { root: HTMLElement; n: Cached; l: Cached }> = {};
  private belt!: HTMLElement;
  private tags: { root: HTMLElement; name: Cached; key: Cached; count: Cached; sub: Cached; load: HTMLElement }[] = [];
  private fireChip!: HTMLElement;
  private fireChipN!: Cached;
  private beltSig = '';
  // the radial wheel of the six tools (touch: the tool button; PC: hold Q)
  private toolWheel!: Wheel;
  private lastH: HudData | null = null;
  // touch cluster: one button per action
  private cbTool!: HTMLElement;
  private cbToolIco!: HTMLElement;
  private cbToolBadge!: HTMLElement;
  private cbToolLoad!: HTMLElement;
  private cbTake!: HTMLElement;
  private cbEat!: HTMLElement;
  private cbEatN!: HTMLElement;
  private cbWait!: HTMLElement;
  private cbRot!: HTMLElement;
  private cbXray!: HTMLElement;
  private cbXrayN!: HTMLElement;
  private cbPut!: HTMLElement;
  private cbJump!: HTMLElement;

  // joystick
  private stick!: HTMLElement;
  private knob!: HTMLElement;
  private stickId: number | null = null;
  private stickOx = 0;
  private stickOy = 0;

  constructor(root: HTMLElement, input: Input) {
    this.root = root;
    this.input = input;
    root.classList.add('ui-root');
    this.readColours();
    // focus rings only for keyboard users (script-focused buttons must not show a ring on a mouse/touch session)
    document.addEventListener('keydown', (e) => { if (/^(Tab|Enter| |Arrow.*)$/.test(e.key)) root.classList.add('kbd'); }, true);
    document.addEventListener('pointerdown', () => root.classList.remove('kbd'), true);

    this.hud = el('div', 'hud');
    root.appendChild(this.hud);

    this.buildTopLeft();
    this.buildTopCentre();
    this.buildTopRight();
    this.buildBottom();
    this.buildTouch();

    this.toasts.setAttribute('aria-live', 'polite');

    this.buildXray();

    this.hintCard = el('div', 'hint');
    this.hintText = el('span', 'hint-text');
    this.hintCard.appendChild(this.hintText);
    this.hintCard.setAttribute('aria-live', 'polite');
    // the pencil note lives in the top-centre flow (under chips / log), never over the player
    this.hudTc.insertBefore(this.hintCard, this.toasts);
    try {
      this.compactMQ = window.matchMedia('(max-height: 460px)');
      const fit = () => this.fitCompact();
      if (this.compactMQ.addEventListener) this.compactMQ.addEventListener('change', fit); else this.compactMQ.addListener(fit);
    } catch { this.compactMQ = null; }
    this.fitCompact();

    this.reticleEl = el('div', 'reticle', '<i></i><i></i><i></i><i></i><b></b>');
    root.appendChild(this.reticleEl);

    root.appendChild(el('div', 'rotate-lock', `<div class="rl-card">${ico('phone', 'rl-phone')}<p class="rl-title">Поверни телефон горизонтально</p><p class="rl-sub">Белая Мгла играется только в ландшафте</p></div>`));
  }

  // ------------------------------------------------------------ build
  /** Re-seat things that differ on a phone in landscape: thermometer crop. */
  private fitCompact(): void {
    const compact = !!this.compactMQ?.matches;
    const svg = this.thermo?.querySelector('.thermo-svg');
    if (svg) svg.setAttribute('viewBox', compact ? '9 6 48 240' : '-28 0 112 252');
    this.thermo?.classList.toggle('compact', compact);
  }

  private readColours(): void {
    try {
      const cs = getComputedStyle(document.documentElement);
      const parse = (v: string, fb: number[]) => {
        const m = /^#?([0-9a-f]{6})$/i.exec(v.trim());
        return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : fb;
      };
      this.mercCold = parse(cs.getPropertyValue('--merc-cold'), this.mercCold);
      this.mercWarm = parse(cs.getPropertyValue('--merc-warm'), this.mercWarm);
    } catch { /* keep defaults */ }
  }

  /** A gauge glass: graduated tube with brass collars, liquid column, engraved label, scale ticks (danger zone tinted). */
  private gauge(key: 'food' | 'stamina' | 'wet' | 'shelter', label: string, icon: string): HTMLElement {
    const root = el('div', `gauge g-${key}`);
    const zone = (i: number) => (key === 'wet' ? i >= 6 : key === 'shelter' ? false : i <= 2) ? ' class="z"' : '';
    const ticks = Array.from({ length: 11 }, (_, i) => `<i${zone(i)}></i>`).join('');
    root.innerHTML = `<span class="g-ico">${ico(icon)}</span><span class="g-lab">${label}</span><span class="g-val mono"><b>0</b><i>%</i></span><span class="g-tube"><span class="g-glass"><i class="g-liq"></i></span></span><span class="g-scale">${ticks}</span>`;
    root.setAttribute('role', 'meter');
    root.setAttribute('aria-label', label.charAt(0) + label.slice(1).toLowerCase());
    root.setAttribute('aria-valuemin', '0'); root.setAttribute('aria-valuemax', '100'); root.setAttribute('aria-valuenow', '0');
    root.title = label.charAt(0) + label.slice(1).toLowerCase();
    root.dataset.q = '0';
    this.gauges[key] = { root, val: root.querySelector('.g-val') as HTMLElement, num: root.querySelector('.g-val b') as HTMLElement };
    return root;
  }

  private buildTopLeft(): void {
    const box = el('div', 'hud-tl');
    this.thermo = el('div', 'plate thermo');
    this.thermo.innerHTML = `
      <div class="thermo-head"><span class="cap">ТЕЛО</span><span class="thermo-val mono"></span></div>
      <div class="thermo-body">${thermoSVG()}</div>
      <div class="thermo-state"></div>
      <i class="rivet r1"></i><i class="rivet r2"></i><i class="rivet r3"></i><i class="rivet r4"></i>`;
    this.mercury = this.thermo.querySelector('#merc') as SVGElement;
    this.mercuryBulb = this.thermo.querySelector('#merc-bulb') as SVGElement;
    this.coreVal = this.thermo.querySelector('.thermo-val') as Cached;
    this.coreState = this.thermo.querySelector('.thermo-state') as Cached;
    box.appendChild(this.thermo);

    const col = el('div', 'gauges');
    col.appendChild(this.gauge('food', 'СЫТОСТЬ', 'food'));
    col.appendChild(this.gauge('stamina', 'СИЛЫ', 'bolt'));
    col.appendChild(this.gauge('wet', 'СЫРОСТЬ', 'drop'));
    col.appendChild(this.gauge('shelter', 'УКРЫТИЕ', 'hut'));
    // enclosure status under the УКРЫТИЕ gauge: a closed roof, or the open top with an arrow toward the nearest opening
    this.enclChip = el('div', 'encl', '<span class="encl-t"></span><svg class="encl-arr" viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 6h8.5M6.5 2.5 10 6l-3.5 3.5"/></svg>');
    this.enclTxt = this.enclChip.querySelector('.encl-t') as Cached;
    this.enclArr = this.enclChip.querySelector('.encl-arr') as unknown as SVGElement;
    this.enclChip.hidden = true;
    col.appendChild(this.enclChip);
    col.insertAdjacentHTML('beforeend', '<i class="rivet r1"></i><i class="rivet r2"></i><i class="rivet r3"></i><i class="rivet r4"></i>');
    box.appendChild(col);
    this.hud.appendChild(box);
  }

  private buildTopCentre(): void {
    const box = el('div', 'hud-tc');
    const chips = el('div', 'chips');
    // [key, icon, label, tier]: pri = what keeps you alive, sec = quiet extras, badge = equipped gear
    const defs: [string, string, string, string][] = [
      ['logs', 'beam', 'брёвна', 'pri'], ['branches', 'branches', 'хворост', 'pri'], ['matches', 'matches', 'спички', 'pri'],
      ['food', 'food', 'еда', 'pri'], ['blocks', 'block', 'блоки', 'sec grp'], ['thermos', 'thermos', 'термос', 'sec'],
      ['snowshoes', 'snowshoes', 'снегоступы', 'badge'],
    ];
    for (const [k, icon, lab, tier] of defs) {
      const root = el('div', `chip c-${k} ${tier}`);
      root.title = lab;
      root.innerHTML = `${ico(icon)}<span class="chip-n mono"></span><span class="chip-l">${lab}</span>`;
      chips.appendChild(root);
      this.chips[k] = { root, n: root.querySelector('.chip-n') as Cached, l: root.querySelector('.chip-l') as Cached };
    }
    // campfire fuel, shown only while the hero stands within the 2 m feed radius
    this.fireChip = el('div', 'chip c-fire pri hidden', `${ico('fire')}<span class="chip-l">Костёр:</span><span class="chip-n mono"></span>`);
    this.fireChip.title = 'Костёр: сколько горит. Подкинуть: E / «Взять»';
    this.fireChipN = this.fireChip.querySelector('.chip-n') as Cached;
    chips.appendChild(this.fireChip);
    // phone: only non-zero items are listed; this chip opens the full row for a few seconds
    const more = el('button', 'chip more', '<span>…</span>');
    more.type = 'button';
    more.tabIndex = -1;
    more.title = 'Весь рюкзак';
    more.setAttribute('aria-label', 'Показать весь рюкзак');
    this.bindPress(more, () => {
      const open = !chips.classList.contains('open');
      chips.classList.toggle('open', open);
      window.clearTimeout(this.chipsTid);
      if (open) this.chipsTid = window.setTimeout(() => chips.classList.remove('open'), 5000);
    });
    chips.appendChild(more);
    box.appendChild(chips);

    this.warnLine = el('div', 'warn-line') as Cached;
    this.warnLine.innerHTML = `<span class="wl-time"></span><span class="warn-text"></span><i class="wl-ul"></i>`;
    this.warnText = this.warnLine.querySelector('.warn-text') as Cached;
    this.warnTime = this.warnLine.querySelector('.wl-time') as Cached;
    this.warnLine.setAttribute('role', 'status');
    box.appendChild(this.warnLine);
    this.toasts = el('div', 'toasts');
    box.appendChild(this.toasts);
    this.hudTc = box;
    this.hud.appendChild(box);
  }

  private buildTopRight(): void {
    const box = el('div', 'hud-tr');
    const row = el('div', 'tr-row');

    const clock = el('div', 'plate clock');
    clock.innerHTML = `<span class="clock-ico">${ico('sun')}</span><span class="clock-day"></span><span class="clock-time mono"></span><span class="clock-wait">ЖДЁМ</span>`;
    this.clockIcon = clock.querySelector('.clock-ico') as HTMLElement;
    this.clockDay = clock.querySelector('.clock-day') as Cached;
    this.clockTime = clock.querySelector('.clock-time') as Cached;
    this.clockWait = clock.querySelector('.clock-wait') as HTMLElement;
    row.appendChild(clock);

    const pause = el('button', 'round-btn pause-btn', ico('pause'));
    pause.type = 'button';
    pause.tabIndex = -1;
    pause.setAttribute('aria-label', 'Пауза');
    this.bindPress(pause, () => this.input.press('pause'));
    row.appendChild(this.fsButton('round-btn fs-btn'));
    row.appendChild(pause);
    box.appendChild(row);

    const dial = el('div', 'plate dial');
    dial.innerHTML = `${dialSVG()}<i class="rivet r1"></i><i class="rivet r2"></i><i class="rivet r3"></i><i class="rivet r4"></i>`;
    this.needle = dial.querySelector('#dial-needle') as SVGElement;
    this.dialDir = dial.querySelector('#dial-dir') as SVGElement;
    this.dialVal = dial.querySelector('#dial-val') as SVGElement;
    box.appendChild(dial);

    const temps = el('div', 'plate temps');
    temps.innerHTML = `<div class="t-row t-air"><span><i class="l-full">воздух</i><i class="l-short">возд.</i></span><b class="mono"></b></div><div class="t-row t-feel"><span><i class="l-full">ощущается</i><i class="l-short">ощущ.</i></span><b class="mono"></b></div>`;
    this.air = temps.querySelector('.t-air b') as Cached;
    this.feel = temps.querySelector('.t-feel b') as Cached;
    this.feelRow = temps.querySelector('.t-feel') as HTMLElement;
    box.appendChild(temps);
    this.hud.appendChild(box);
  }

  private buildXray(): void {
    this.xrayEl = el('div', 'plate xray');
    this.xrayEl.setAttribute('aria-hidden', 'true');
    // compact strip in the top-centre flow (under the pack chips): never over the player
    this.hudTc.insertBefore(this.xrayEl, this.warnLine);
  }

  /** X-ray legend: mode 0 hides it, 1 density, 2 sintering, 3 temperature. Also says the mode name in a toast. */
  setXray(mode: number): void {
    const m = XRAY[mode] ? mode : 0;
    if (m === this.xrayMode) return;
    this.xrayMode = m;
    const d = XRAY[m];
    if (d) {
      const ticks = d.ticks.map((t) => `<i class="${t.mark ? 'mk' : ''}" style="left:${(t.at * 100).toFixed(1)}%"></i><span class="${t.edge ?? ''}" style="left:${(t.at * 100).toFixed(1)}%">${t.text}</span>`).join('');
      this.xrayEl.innerHTML = `<div class="xr-head"><span class="cap">${ico('xray')}<b class="cap-t">Рентген</b></span><span class="xr-mode mono">${m}/3</span></div><div class="xr-title"></div><div class="xr-key"><div class="xr-bar"></div><div class="xr-scale">${ticks}</div></div>`;
      (this.xrayEl.querySelector('.xr-title') as HTMLElement).textContent = d.title;
      (this.xrayEl.querySelector('.xr-bar') as HTMLElement).style.background = xrGradient(d);
    }
    this.xrayEl.classList.toggle('on', m > 0);
    this.root.classList.toggle('has-xray', m > 0);
    this.toast(XR_TOAST[m], 'info');
  }

  /** Pause-screen physics line, e.g. "Rapier 2D · 58 к/с · тел 12". Call as often as you like. */
  setPhysInfo(text: string): void {
    if (text === this.physInfo) return;
    this.physInfo = text;
    this.paintPhys();
  }

  private paintPhys(): void {
    const p = this.physEls; if (!p) return;
    p.info.textContent = this.physInfo || '—';
  }

  private buildBottom(): void {
    this.belt = el('div', 'belt');
    this.belt.setAttribute('role', 'toolbar');
    this.belt.setAttribute('aria-label', 'Инструменты');
    this.hud.appendChild(this.belt);
  }

  private buildTags(tools: HudData['tools']): void {
    this.belt.textContent = '';
    this.tags = [];
    tools.forEach((t, i) => {
      const root = el('button', `tag tag-${t.id}`);
      root.type = 'button';
      root.tabIndex = -1;
      root.innerHTML = `<i class="tag-hole"></i><span class="tag-key mono"></span>${ico(TOOL_ICON[t.id] ?? 'block', 'tag-ico')}<span class="tag-name"></span><span class="tag-count mono"></span><span class="tag-sub"></span><span class="tag-load"><i></i></span>`;
      root.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.input.pressTool(i); });
      root.addEventListener('mousedown', (e) => e.preventDefault());
      this.belt.appendChild(root);
      this.tags.push({
        root, name: root.querySelector('.tag-name') as Cached, key: root.querySelector('.tag-key') as Cached,
        count: root.querySelector('.tag-count') as Cached, sub: root.querySelector('.tag-sub') as Cached, load: root.querySelector('.tag-load i') as HTMLElement,
      });
    });
    this.input.toolCount = tools.length || 6;
  }

  private bindPress(b: HTMLElement, fn: () => void): void {
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('down'); fn(); });
    const up = () => b.classList.remove('down');
    b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => e.preventDefault());
  }

  private buildTouch(): void {
    const touch = el('div', 'touch');

    // floating joystick
    const zone = el('div', 'stick-zone');
    this.stick = el('div', 'stick', '<i class="stick-ring"></i><i class="stick-up"></i><i class="stick-knob"></i>');
    this.knob = this.stick.querySelector('.stick-knob') as HTMLElement;
    zone.appendChild(this.stick);
    touch.appendChild(zone);
    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      e.preventDefault(); e.stopPropagation();
      this.stickId = e.pointerId;
      try { zone.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.stickOx = e.clientX; this.stickOy = e.clientY;
      this.stick.classList.add('active');
      this.stick.style.transform = `translate3d(${e.clientX - zone.getBoundingClientRect().left}px, ${e.clientY - zone.getBoundingClientRect().top}px, 0)`;
      this.stickMove(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) this.stickMove(e.clientX, e.clientY); });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.stick.classList.remove('active');
      this.stick.style.transform = '';
      this.knob.style.transform = '';
      this.input.setStick(0, false, false);
    };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);

    // compact cluster: every action is its own button (right thumb); the tool button opens the one radial wheel left (the tools)
    const cl = el('div', 'tcluster');
    const mk = (cls: string, label: string, html: string) => {
      const b = el('button', `cbtn ${cls}`, html);
      b.type = 'button'; b.tabIndex = -1; b.setAttribute('aria-label', label); b.title = label;
      return b;
    };
    const icon = (k: string) => `<span class="cb-ico">${ico(k)}</span>`;
    const cap = (t: string) => `<i class="cb-lab">${t}</i>`;
    this.cbTool = mk('cb-tool wheel-opener', 'Инструмент', `${icon('shovel')}<i class="cb-badge mono"></i><i class="cb-load"><i></i></i>`);
    this.cbToolIco = this.cbTool.querySelector('.cb-ico') as HTMLElement;
    this.cbToolBadge = this.cbTool.querySelector('.cb-badge') as HTMLElement;
    this.cbToolLoad = this.cbTool.querySelector('.cb-load i') as HTMLElement;
    this.cbTake = mk('cb-take', 'Взять', `${icon('take')}${cap('Взять')}`);
    this.cbEat = mk('cb-eat', 'Съесть', `${icon('eat')}${cap('Съесть')}<i class="cb-badge mono"></i>`);
    this.cbEatN = this.cbEat.querySelector('.cb-badge') as HTMLElement;
    this.cbWait = mk('cb-wait', 'Ждать', `${icon('wait')}${cap('Ждать')}`);
    this.cbRot = mk('cb-rot', 'Поворот', `${icon('rotate')}${cap('Поворот')}`);
    this.cbXray = mk('cb-xray', 'Рентген', `${icon('xray')}<i class="cb-badge mono"></i>`);
    this.cbXrayN = this.cbXray.querySelector('.cb-badge') as HTMLElement;
    this.cbPut = mk('cb-put', 'Положить, бросить', `${icon('put')}${cap('Положить')}`);
    this.cbJump = mk('cb-jump', 'Прыжок', icon('jump'));
    this.cbTool.setAttribute('aria-haspopup', 'menu');
    cl.append(this.cbTool, this.cbTake, this.cbEat, this.cbWait, this.cbRot, this.cbXray, this.cbPut, this.cbJump);
    this.bindPress(this.cbTake, () => this.input.press('interact'));
    this.bindPress(this.cbEat, () => this.input.press('eat'));
    this.bindPress(this.cbWait, () => this.input.toggleWait());
    this.bindPress(this.cbRot, () => this.input.press('rotate'));
    this.bindPress(this.cbXray, () => this.input.press('xray'));
    this.bindPress(this.cbPut, () => this.input.press('secondary'));
    // jump: holdable (pushing against a wall while holding it climbs out of a pit)
    const jb = this.cbJump;
    jb.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      try { jb.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      jb.classList.add('down'); this.input.setJumpHeld(true);
    });
    const jup = () => { jb.classList.remove('down'); this.input.setJumpHeld(false); };
    jb.addEventListener('pointerup', jup); jb.addEventListener('pointercancel', jup); jb.addEventListener('pointerleave', jup); jb.addEventListener('lostpointercapture', jup);
    jb.addEventListener('mousedown', (e) => e.preventDefault()); jb.addEventListener('click', (e) => e.preventDefault());

    // the radial wheel of the six tools
    this.toolWheel = new Wheel(this.root, 'Инструмент', 'выбери', 'wheel-tools');
    this.toolWheel.onToggle = (open) => {
      this.input.setBlocked(this.toolWheel.open || open);
      this.root.classList.toggle('wheel-open', open);
      this.cbTool.classList.toggle('open', open); this.cbTool.setAttribute('aria-expanded', String(open));
      if (!open) window.setTimeout(() => this.input.setBlocked(this.toolWheel.open), 0);
    };
    this.toolWheel.onPick = (id) => { this.input.pressTool(Number(id)); };
    // tool button: press opens the wheel around itself; drag onto a tool and lift (flick), or tap a tool
    this.cbTool.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (this.toolWheel.open) { this.toolWheel.close(); return; }
      this.toolWheel.setItems(this.toolItems());
      const r = this.cbTool.getBoundingClientRect();
      this.toolWheel.show(r.left + r.width / 2, r.top + r.height / 2, 'drag', e.pointerId);
    });
    this.cbTool.addEventListener('mousedown', (e) => e.preventDefault());
    this.cbTool.addEventListener('click', (e) => e.preventDefault());
    // PC: hold Q = the same tool wheel at the cursor, release over an item picks it
    this.input.onWheelKey = (ph) => {
      if (ph === 'open') {
        if (this.overlay) return;
        const s = this.input.state;
        this.toolWheel.setItems(this.toolItems());
        this.toolWheel.show(s.hasAim ? s.aimX : window.innerWidth / 2, s.hasAim ? s.aimY : window.innerHeight / 2, 'hold');
      } else if (ph === 'close') this.toolWheel.release();
      else this.toolWheel.close();
    };
    touch.appendChild(cl);
    this.root.classList.add('has-wheels');
    this.hud.appendChild(touch);
  }

  private toolItems(): WheelItem[] {
    const h = this.lastH; if (!h) return [];
    return h.tools.map((t, i) => {
      const bar = this.toolBar(t.id, h);
      const live = t.id === 'fire' && h.fire ? `Костёр: ${fireText(h.fire)}` : this.liveSub(t.id, h);
      return {
        id: String(i), label: t.name, icon: ico(toolIconName(t.id, h.beamMode)),
        badge: t.count === undefined ? undefined : String(t.count), sub: live || TOOL_SUB[t.id] || '',
        bar: bar > 0.02 ? bar : undefined,
        cls: [i === h.tool ? 'sel' : '', t.enabled ? '' : 'off', t.count === 0 ? 'empty' : '', t.id === 'fire' ? 'fire' : ''].filter(Boolean).join(' '),
      };
    });
  }

  /** Live caption for a tool ('' = none): shovel dig %, cut progress, beam shape, campfire fuel. Shared by the belt tags and the wheel. */
  private liveSub(id: string, h: HudData): string {
    if (id === 'shovel') return h.digP > 0.01 ? `копает ${Math.round(h.digP * 100)}%` : '';
    if (id === 'saw') return this.sawLive(h) ? `Пилю… ${Math.round(h.sawP * 100)}%` : '';
    if (id === 'beam') return h.beamMode;
    if (id === 'fire') return h.fire ? fireText(h.fire) : '';
    return '';
  }
  /** a cut in progress is shown only while the saw is in hand: a half-finished cut elsewhere waits quietly (it drains slowly) */
  private sawLive(h: HudData): boolean { return h.sawP > 0.005 && h.tools[h.tool]?.id === 'saw'; }
  /** Meter 0..1 for a tool, quantised to 1/40 so the bar is not redrawn for tiny changes (0 = hidden). */
  private toolBar(id: string, h: HudData): number {
    const q = (v: number) => Math.round(clamp(v, 0, 1) * 40) / 40;
    if (id === 'shovel') return q(h.digP);
    if (id === 'saw') return this.sawLive(h) ? q(h.sawP) : 0;
    if (id === 'fire') return h.fire ? q(h.fire.fuel / FIRE_FULL_MIN) : 0;
    return 0;
  }

  private stickMove(cx: number, cy: number): void {
    const R = Math.max(40, Math.min(64, window.innerHeight * 0.14));
    let dx = cx - this.stickOx, dy = cy - this.stickOy;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
    this.knob.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    let x = dx / R; const up = -dy / R;
    x = Math.abs(x) < 0.16 ? 0 : (x - Math.sign(x) * 0.16) / 0.84;
    this.input.setStick(x, up > 0.6, Math.abs(dx / R) > 0.85);
  }

  // ------------------------------------------------------------ helpers
  private txt(e: Cached, s: string): void { if (e._t !== s) { e._t = s; e.textContent = s; } }
  private m(key: string, v: string | number | boolean, apply: () => void): void {
    if (this.memo[key] === v) return;
    this.memo[key] = v; apply();
  }

  // ------------------------------------------------------------ update
  update(h: HudData): void {
    const inp = this.input;
    inp.currentTool = h.tool;
    this.lastH = h;
    this.updateReticle();

    const now = performance.now();
    if (now - this.last < 95) return;
    this.last = now;

    // belt (rebuild only when the set of tools changes)
    const sig = h.tools.map((t) => t.id).join(',');
    if (sig !== this.beltSig) { this.beltSig = sig; this.buildTags(h.tools); }

    // ---- core temperature
    const core = clamp(h.core, T_MIN - 1, T_MAX + 1);
    const q = Math.round(core * 20) / 20;
    this.m('core', q, () => {
      const y = tY(q);
      this.mercury.setAttribute('y', y.toFixed(1));
      this.mercury.setAttribute('height', (232 - y).toFixed(1));
      const k = clamp((q - 35) / 1.6, 0, 1);
      const c = this.mercCold.map((a, i) => Math.round(a + (this.mercWarm[i] - a) * k));
      const col = `rgb(${c[0]},${c[1]},${c[2]})`;
      this.mercury.setAttribute('fill', col);
      this.mercuryBulb.setAttribute('fill', col);
      this.thermo.style.setProperty('--merc', col);
    });
    this.txt(this.coreVal, fmtCore(h.core) + '°');
    const st = h.core >= 36.6 ? 'норма' : h.core >= 35 ? 'дрожь' : h.core >= 32 ? 'гипотермия' : 'критично';
    this.txt(this.coreState, st);
    this.m('core-lvl', h.core >= 36.6 ? 0 : h.core >= 35 ? 1 : h.core >= 32 ? 2 : 3, () => {
      this.thermo.dataset.level = String(h.core >= 36.6 ? 0 : h.core >= 35 ? 1 : h.core >= 32 ? 2 : 3);
    });

    // ---- gauges
    this.setGauge('food', h.food, false);
    this.setGauge('stamina', h.stamina, false);
    this.setGauge('wet', h.wet, true);
    this.setGauge('shelter', h.shelter, false, true);
    // ---- enclosure chip (main.ts reads the air pocket at 4 Hz; the chip only follows it)
    const en = h.encl;
    this.m('encl', en.st + '|' + (en.ang == null ? '' : String(Math.round(en.ang / 5))), () => {
      const c = this.enclChip;
      c.hidden = en.st === 'none';
      c.dataset.st = en.st;
      this.txt(this.enclTxt, en.st === 'closed' ? 'Укрытие: закрыто ✓' : en.st === 'open' ? 'открыто сверху — закрой крышей' : en.st === 'big' ? 'Укрытие: большая полость' : '');
      if (en.st === 'open' && en.ang != null) { c.dataset.arrow = '1'; this.enclArr.style.transform = `rotate(${en.ang.toFixed(0)}deg)`; }
      else delete c.dataset.arrow;
    });

    // ---- wind dial
    const w = Math.abs(h.wind);
    const wa = Math.round(clamp(w, 0, 30) * 9) / 9; // 0.11 m/s steps
    this.m('wind', wa, () => this.needle.style.transform = `translate(60px, 60px) rotate(${135 + (wa / 30) * 270}deg)`);
    this.m('wdir', Math.abs(h.wind) < 0.5 ? 0 : Math.sign(h.wind), () => {
      const s = Math.abs(h.wind) < 0.5 ? 0 : Math.sign(h.wind);
      this.dialDir.style.opacity = s === 0 ? '0' : '1';
      this.dialDir.style.transform = `translate(60px, 0) scaleX(${s || 1}) translate(-60px, 0)`;
    });
    const wt = String(Math.round(w));
    this.m('wtxt', wt, () => { this.dialVal.textContent = wt; });
    this.txt(this.air, fmtDeg(h.airT));
    this.txt(this.feel, fmtDeg(h.feelT));
    this.m('feelhot', h.feelT < -40, () => this.feelRow.classList.toggle('danger', h.feelT < -40));

    // ---- clock
    this.txt(this.clockDay, 'ДЕНЬ ' + h.day);
    this.txt(this.clockTime, h.clock);
    this.m('night', h.night, () => {
      this.clockIcon.innerHTML = ico(h.night ? 'moon' : 'sun');
      this.root.classList.toggle('is-night', h.night);
    });
    const waiting = h.waiting;
    this.m('wait', waiting, () => this.clockWait.classList.toggle('on', waiting));

    // ---- weather log: entries are stamped with the time they were first noted
    const warn = h.warning ?? '';
    this.m('warn', warn, () => {
      if (warn) { this.warnText.textContent = warn; this.warnTime.textContent = h.clock; }
      this.warnLine.classList.toggle('on', !!warn);
    });

    // ---- one shared heartbeat, only on the single most critical item
    this.updateBeat(h, core, !!warn);

    // ---- inventory
    const inv = h.inv;
    this.setChip('logs', inv.logs); this.setChip('branches', inv.branches); this.setChip('matches', inv.matches);
    this.setChip('food', inv.food); this.setChip('blocks', inv.blocks);
    this.setChip('snowshoes', inv.snowshoes ? 1 : 0, '', inv.snowshoes);
    this.setChip('thermos', inv.thermos, undefined, inv.thermos > 0);
    this.m('lowmatch', inv.matches, () => this.chips.matches.root.classList.toggle('warn', inv.matches <= 1));
    this.m('starving', h.food < 0.2, () => {
      this.gauges.food.root.classList.toggle('starving', h.food < 0.2);
      if (h.food < 0.2 && !this.hungerToast) { this.hungerToast = true; this.toast('Голод: съешь что-нибудь (Q)', 'warn'); }
      else if (h.food >= 0.2) this.hungerToast = h.food < 0.35 && this.hungerToast;
    });
    const hungry = h.food < 0.3 && inv.food > 0;
    this.m('hungry', hungry, () => this.chips.food.root.classList.toggle('warn', hungry));

    // ---- tool tags
    h.tools.forEach((t, i) => {
      const g = this.tags[i]; if (!g) return;
      this.txt(g.name, t.name); this.txt(g.key, t.key);
      this.txt(g.count, t.count === undefined ? '' : String(t.count));
      const ti = toolIconName(t.id, h.beamMode);
      this.m('tagico' + i, ti, () => { const old = g.root.querySelector('.tag-ico'); if (old) old.outerHTML = ico(ti, 'tag-ico'); });
      this.m('tag' + i, (i === h.tool ? 1 : 0) + (t.enabled ? 2 : 0) + ((t.count ?? 1) === 0 ? 4 : 0), () => {
        g.root.classList.toggle('sel', i === h.tool);
        g.root.classList.toggle('off', !t.enabled);
        g.root.classList.toggle('empty', t.count === 0);
        g.root.setAttribute('aria-pressed', String(i === h.tool));
      });
      // live line under the name (shovel dig %, cut %, beam shape, fire fuel) and the 4 px meter under it
      this.txt(g.sub, this.liveSub(t.id, h));
      const bar = this.toolBar(t.id, h);
      this.m('tb' + i, bar, () => {
        g.load.style.transform = `scaleX(${bar})`;
        g.root.classList.toggle('loaded', bar > 0.02);
        g.root.classList.toggle('full', t.id === 'shovel' && bar > 0.85);
      });
    });

    // ---- touch cluster: the tool button shows the current tool + count (the other buttons: paintTouch)
    const ct = h.tools[h.tool];
    if (ct) {
      const cti = toolIconName(ct.id, h.beamMode);
      this.m('cbtool', ct.id + cti, () => { this.cbToolIco.innerHTML = ico(cti); this.cbTool.classList.toggle('fire', ct.id === 'fire'); this.cbPut.classList.toggle('fire', ct.id === 'fire'); this.cbTool.title = 'Инструмент: ' + ct.name; this.cbTool.setAttribute('aria-label', 'Инструмент: ' + ct.name); });
      // badge: the count, or the live % while the saw cuts
      const live = ct.id === 'saw' && h.sawP > 0.005 ? `${Math.round(h.sawP * 100)}%` : '';
      const cnt = live || (ct.count === undefined ? '' : String(ct.count));
      this.m('cbcnt', cnt, () => { this.cbToolBadge.textContent = cnt; this.cbToolBadge.style.display = cnt ? '' : 'none'; this.cbToolBadge.classList.toggle('live', !!live); this.cbTool.classList.toggle('empty', ct.count === 0); });
      const bar = this.toolBar(ct.id, h);
      this.m('cbload', ct.id + bar, () => { this.cbToolLoad.style.transform = `scaleX(${bar})`; this.cbTool.classList.toggle('loaded', bar > 0.02); this.cbTool.classList.toggle('full', ct.id === 'shovel' && bar > 0.85); });
    }
    // campfire chip: fuel of the fire the hero stands by (inside the 2 m feed radius); an unlit fire says so
    const fn = h.fire && h.fire.near ? h.fire : null;
    const fct = fn ? fireText(fn) : '';
    this.m('firechip', fct + (fn && !fn.lit ? '!' : ''), () => {
      this.fireChip.classList.toggle('hidden', !fn);
      this.fireChip.classList.toggle('warn', !!fn && !fn.lit);
      this.txt(this.fireChipN, fct);
    });
    this.paintTouch(h, hungry);
    if (this.toolWheel?.open) this.toolWheel.setItems(this.toolItems());

    // ---- hint
    const hint = h.hint ?? '';
    this.m('hint', hint, () => {
      if (hint) this.hintText.textContent = hint;
      this.hintCard.classList.toggle('on', !!hint);
      // fades after 4 s, or ~80 ms per character for a long tip (the igloo scheme needs reading time), so it never hides the work; any change restores it
      window.clearTimeout(this.hintTid);
      this.hintCard.classList.remove('dim');
      if (hint) this.hintTid = window.setTimeout(() => this.hintCard.classList.add('dim'), Math.max(4000, hint.length * 80));
    });
  }

  /** Touch cluster state for every button but the tool (memoised per state, so a steady frame paints nothing).
   *  eat: ember pulse when hungry, dimmed with no food, the count on it · wait: lit while time runs fast, ice ring when waiting is possible here
   *  (sheltered, or a lit fire within the feed radius), dimmed otherwise · rotate: only the beam and the block turn · x-ray: lit, mode number on it ·
   *  take: glows when E would feed a campfire at hand (crates and loose logs have no cheap signal in HudData, so they do not glow). */
  private paintTouch(h: HudData, hungry: boolean): void {
    const inv = h.inv;
    const eatNone = inv.food <= 0;
    this.m('cb-eat', (hungry ? 1 : 0) + (eatNone ? 2 : 0) + ':' + inv.food, () => {
      this.cbEat.classList.toggle('urgent', hungry && !eatNone);
      this.cbEat.classList.toggle('dim', eatNone);
      this.cbEat.setAttribute('aria-disabled', String(eatNone));
      this.cbEatN.textContent = String(inv.food);
    });

    // 'on' = time is running fast now; aria-pressed = the toggle itself (it may be armed and wait for a shelter or a fire)
    const waiting = h.waiting, armed = this.input.waitToggled;
    const spot = h.shelter >= 0.5 || !!(h.fire && h.fire.lit && h.fire.near);   // main.ts: shelter >= 0.5, or a lit fire within 40 cells
    this.m('cb-wait', (waiting ? 1 : 0) + (spot ? 2 : 0) + (armed ? 4 : 0), () => {
      this.cbWait.classList.toggle('on', waiting);
      this.cbWait.classList.toggle('ready', !waiting && spot);
      this.cbWait.classList.toggle('dim', !waiting && !spot);
      this.cbWait.setAttribute('aria-pressed', String(armed));
    });

    const ct = h.tools[h.tool];
    const rotOn = !!ct && (ct.id === 'beam' || ct.id === 'block');
    this.m('cb-rot', rotOn, () => this.cbRot.classList.toggle('dim', !rotOn));

    this.m('cb-xray', this.xrayMode, () => {
      this.cbXray.classList.toggle('on', this.xrayMode > 0);
      this.cbXrayN.textContent = this.xrayMode ? String(this.xrayMode) : '';
      const t = this.xrayMode ? `Рентген ${this.xrayMode}/3: ${XRAY[this.xrayMode].name}` : 'Рентген: выкл.';
      this.cbXray.title = t; this.cbXray.setAttribute('aria-label', t);
    });

    // E feeds a fire within the feed radius: a lit one takes a log or branches, an unlit one needs matches and fuel left (feedFire in tools.ts)
    const feed = !!h.fire && h.fire.near && (h.fire.lit ? inv.logs > 0 || inv.branches > 0 : inv.matches > 0 && h.fire.fuel > 0);
    this.m('cb-take', feed, () => this.cbTake.classList.toggle('glow', feed));
  }

  private setGauge(k: 'food' | 'stamina' | 'wet' | 'shelter', v: number, invert: boolean, calm = false): void {
    const g = this.gauges[k];
    const q = Math.round(clamp(v, 0, 1) * 100) / 100;
    this.gaugeQ[k] = q;
    this.m('g' + k, q, () => {
      g.root.style.setProperty('--q', String(q));
      const pct = Math.round(q * 100);
      g.num.textContent = String(pct);
      g.root.dataset.q = pct === 0 ? '0' : '1';
      g.root.setAttribute('aria-valuenow', String(pct));
      const lvl = calm ? 'calm' : (invert ? (q > 0.6 ? 'bad' : q > 0.35 ? 'mid' : 'ok') : (q < 0.2 ? 'bad' : q < 0.4 ? 'mid' : 'ok'));
      g.root.dataset.level = lvl;
    });
  }

  /** Pick the one item that deserves the heartbeat (severity >= 30); everything else stays still. */
  private updateBeat(h: HudData, core: number, warn: boolean): void {
    let best: HTMLElement | null = null, bs = 29;
    const cand = (e: HTMLElement, s: number) => { if (s > bs) { bs = s; best = e; } };
    cand(this.thermo, core < 32 ? 100 : core < 35 ? 70 : 0);
    const gq = this.gaugeQ;
    cand(this.gauges.food.root, gq.food < 0.2 ? 50 + (0.2 - gq.food) * 100 : 0);
    cand(this.gauges.stamina.root, gq.stamina < 0.2 ? 48 + (0.2 - gq.stamina) * 100 : 0);
    cand(this.gauges.wet.root, gq.wet > 0.6 ? 40 + (gq.wet - 0.6) * 60 : 0);
    cand(this.warnLine, warn ? 35 : 0);
    cand(this.chips.matches.root, h.inv.matches <= 0 ? 30 : 0);
    if (best !== this.beatEl) {
      this.beatEl?.classList.remove('beat');
      this.beatEl = best;
      (best as HTMLElement | null)?.classList.add('beat');
    }
  }

  private setChip(k: string, n: number, label?: string, visible = true): void {
    const c = this.chips[k]; if (!c) return;
    this.txt(c.n, label ?? String(n));
    const w = CHIP_WORDS[k];   // the caption agrees with the count: 1 бревно, 2 бревна, 5 брёвен
    if (w) { const word = plural(n, w[0], w[1], w[2]); this.txt(c.l, word); this.m('chipw' + k, word, () => { c.root.title = word; }); }
    this.m('chip' + k, (n > 0 ? 1 : 0) + (visible ? 2 : 0), () => {
      c.root.classList.toggle('zero', n <= 0);
      c.root.classList.toggle('hidden', !visible);
    });
  }

  private updateReticle(): void {
    const s = this.input.state;
    // the aim stays in Input for the secondary/fire buttons; the mark itself fades 1.5 s after the finger lifts
    const now = performance.now();
    if (s.primary) this.retUntil = now + 1500;
    const show = this.input.mobile && s.hasAim && (now < this.retUntil || now - this.input.touchAt < 1500);
    this.m('ret-show', show, () => this.reticleEl.classList.toggle('on', show));
    if (!show) return;
    this.m('ret-down', s.primary, () => this.reticleEl.classList.toggle('down', s.primary));
    const x = Math.round(s.aimX), y = Math.round(s.aimY);
    this.m('ret-pos', x * 10000 + y, () => { this.reticleEl.style.transform = `translate3d(${x}px, ${y}px, 0)`; });
  }

  // ------------------------------------------------------------ toasts
  toast(msg: string, kind: 'info' | 'warn' | 'good' = 'info'): void {
    const existing = Array.from(this.toasts.children).find((c) => c.getAttribute('data-msg') === msg) as HTMLElement | undefined;
    if (existing) { existing.classList.remove('out'); window.clearTimeout(Number(existing.dataset.tid)); existing.dataset.tid = String(this.scheduleToast(existing)); return; }
    const t = el('div', `toast ${kind}`, `<i class="toast-bar"></i><span></span>`);
    (t.querySelector('span') as HTMLElement).textContent = msg;
    t.setAttribute('data-msg', msg);
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    t.dataset.tid = String(this.scheduleToast(t));
  }

  private scheduleToast(t: HTMLElement): number {
    return window.setTimeout(() => {
      t.classList.add('out');
      window.setTimeout(() => t.remove(), 500);
    }, 3800);
  }

  // ------------------------------------------------------------ overlays
  private setOverlay(node: HTMLElement, mode: 'title' | 'pause' | 'end' | 'bench'): void {
    // anything still fading out must go now, otherwise stacked leaving overlays leak
    this.root.querySelectorAll('.overlay.leaving').forEach((n) => n.remove());
    this.toolWheel?.close();
    this.overlay?.remove();
    this.physEls = null;
    this.overlay = node;
    this.root.appendChild(node);
    this.root.classList.remove('ov-title', 'ov-pause', 'ov-end', 'ov-bench');
    this.root.classList.add('has-overlay', 'ov-' + mode);
    document.documentElement.dataset.overlay = '1';
    requestAnimationFrame(() => node.classList.add('in'));
  }

  /** bench.ts: show a custom full-screen card (results) through the normal overlay machinery */
  mountOverlay(node: HTMLElement, mode: 'bench'): void { this.setOverlay(node, mode); }
  /** bench.ts: the HUD root, to mount the run strip into */
  get host(): HTMLElement { return this.root; }

  hide(): void {
    const ov = this.overlay;
    this.overlay = null;
    this.root.classList.remove('has-overlay', 'ov-title', 'ov-pause', 'ov-end', 'ov-bench');
    document.documentElement.dataset.overlay = '0';
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (!ov) return;
    ov.classList.remove('in');
    ov.classList.add('leaving');
    this.physEls = null;
    window.setTimeout(() => ov.remove(), 450);
  }

  /** «На весь экран»: Fullscreen API (+ landscape lock where allowed); every instance follows fullscreenchange */
  private fsBtns: HTMLButtonElement[] = [];
  private fsButton(cls: string): HTMLButtonElement {
    const b = el('button', cls, ico('full')) as HTMLButtonElement;
    b.type = 'button'; b.tabIndex = -1;
    this.fsBtns.push(b);
    if (this.fsBtns.length === 1) {
      const sync = () => { const on = !!(document.fullscreenElement || (document as any).webkitFullscreenElement); for (const x of this.fsBtns) { x.innerHTML = ico(on ? 'unfull' : 'full'); const t = on ? 'Выйти из полноэкранного режима' : 'На весь экран'; x.title = t; x.setAttribute('aria-label', t); x.setAttribute('aria-pressed', String(on)); } };
      document.addEventListener('fullscreenchange', sync); document.addEventListener('webkitfullscreenchange', sync);
      queueMicrotask(sync);
    }
    const fn = () => { void this.toggleFullscreen(); };
    if (cls.includes('round-btn')) this.bindPress(b, fn); else b.addEventListener('click', (e) => { e.preventDefault(); fn(); b.blur(); });
    return b;
  }
  private async toggleFullscreen(): Promise<void> {
    const d = document as any, root = document.documentElement as any;
    try {
      if (document.fullscreenElement || d.webkitFullscreenElement) { await (document.exitFullscreen ? document.exitFullscreen() : d.webkitExitFullscreen?.()); return; }
      const req = root.requestFullscreen || root.webkitRequestFullscreen;
      if (!req) throw new Error('no api');
      await req.call(root, { navigationUI: 'hide' });
      try { await (screen.orientation as any)?.lock?.('landscape'); } catch { /* not allowed here: fine */ }
    } catch {
      this.toast('Полный экран здесь недоступен — открой игру в отдельной вкладке браузера', 'warn');
    }
  }

  private btn(label: string, cls: string, fn: () => void): HTMLButtonElement {
    const b = el('button', `btn ${cls}`, `<span>${label}</span>`);
    b.type = 'button';
    b.addEventListener('click', () => { fn(); });
    return b;
  }

  showTitle(onStart: () => void): void {
    const ov = el('div', 'overlay title');
    const keys = (arr: string[]) => arr.map((k) => `<kbd>${k}</kbd>`).join('');
    ov.innerHTML = `
      <svg class="title-rings" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
        <circle cx="200" cy="200" r="196"/><circle cx="200" cy="200" r="168"/><circle cx="200" cy="200" r="120" class="dash"/>
        ${Array.from({ length: 72 }, (_, i) => { const a = (i * 5 * Math.PI) / 180, r1 = i % 6 === 0 ? 176 : 184; return `<line x1="${(200 + Math.cos(a) * r1).toFixed(1)}" y1="${(200 + Math.sin(a) * r1).toFixed(1)}" x2="${(200 + Math.cos(a) * 192).toFixed(1)}" y2="${(200 + Math.sin(a) * 192).toFixed(1)}"/>`; }).join('')}
      </svg>
      <svg class="title-ridge" viewBox="0 0 1200 240" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
        <path class="rg-far" d="M0 240V150l64-26 52 22 78-62 66 52 54-26 92 74 74-46 58 36 116-96 84 86 66-38 88 56 70-64 62 46 72-38 90 68 76-30 66 36 88-52V240Z"/>
        <path class="rg-near" d="M0 240V196l92-32 66 24 112-62 82 52 104-38 88 40 134-58 100 52 92-26 108 46 96-30 126 42V240Z"/>
        <path class="rg-edge" d="M0 196l92-32 66 24 112-62 82 52 104-38 88 40 134-58 100 52 92-26 108 46 96-30 126 42"/>
      </svg>
      <div class="title-frame">
        <div class="kicker"><i></i><span>Полевой журнал · плато</span><i></i></div>
        <h1 class="title-name"><span>БЕЛАЯ</span><span>МГЛА</span></h1>
        <p class="premise">Метель отрезала тебя от лагеря: вокруг только снег, ветер и мороз.<br>Копай, руби, строй укрытие, береги огонь и сухую одежду.</p>
        <div class="goal"><span class="goal-moons">${ico('moon')}${ico('moon')}${ico('moon')}</span><span class="goal-text">Цель: <b>переживи 3 ночи</b></span></div>
        <div class="controls controls-pc">
          <div><span class="kk">${keys(['A', 'D'])}</span><em>идти</em></div>
          <div><span class="kk">${keys(['Shift'])}</span><em>бежать</em></div>
          <div><span class="kk">${keys(['W'])}${keys(['Пробел'])}</span><em>прыжок</em></div>
          <div><span class="kk"><kbd class="m">Мышь</kbd></span><em>прицел</em></div>
          <div><span class="kk"><kbd class="m">ЛКМ</kbd></span><em>работа инструментом</em></div>
          <div><span class="kk"><kbd class="m">ПКМ</kbd></span><em>положить, бросить</em></div>
          <div><span class="kk">${keys(['1'])}<b>–</b>${keys(['6'])}</span><em>инструменты, колесо</em></div>
          <div><span class="kk">${keys(['E'])}${keys(['Q'])}</span><em>взять, съесть</em></div>
          <div><span class="kk">${keys(['F'])}${keys(['R'])}</span><em>костёр, повернуть брус</em></div>
          <div><span class="kk">${keys(['T'])}</span><em>ждать в укрытии</em></div>
          <div><span class="kk">${keys(['X'])}</span><em>рентген снега</em></div>
          <div><span class="kk">${keys(['Esc'])}</span><em>пауза</em></div>
        </div>
        <div class="controls controls-touch">
          <div><span class="tk">${ico('stick')}</span><em><b>Стик</b><i>ход и прыжок</i></em></div>
          <div><span class="tk">${ico('shovel')}</span><em><b>Касание</b><i>копать, строить</i></em></div>
          <div><span class="tk">${ico('pad')}</span><em><b>Кнопки</b><i>съесть, ждать</i></em></div>
        </div>
        <div class="title-actions"></div>
      </div>
      `;
    const actions = ov.querySelector('.title-actions') as HTMLElement;
    const start = this.btn('В путь', 'btn-primary btn-start', () => { onStart(); });
    const snd = el('button', 'btn btn-ghost btn-sound', ico(this.soundOn ? 'sound' : 'mute'));
    snd.type = 'button';
    snd.setAttribute('aria-pressed', String(this.soundOn));
    const sndLabel = () => { const t = 'Звук: ' + (this.soundOn ? 'вкл' : 'выкл'); snd.title = t; snd.setAttribute('aria-label', t); };
    sndLabel();
    snd.addEventListener('click', () => {
      this.soundOn = !this.soundOn;
      snd.innerHTML = ico(this.soundOn ? 'sound' : 'mute');
      sndLabel();
      snd.setAttribute('aria-pressed', String(this.soundOn));
      this.onSound(this.soundOn);
      snd.blur();
    });
    const benchBtn = this.btn('Тест производительности', 'btn-ghost btn-bench', () => { this.onBench(false); });
    benchBtn.insertAdjacentHTML('afterbegin', ico('timer'));
    benchBtn.title = 'Автоматический прогон всех сценариев игры: кадры, узкие места, отчёт';
    actions.append(start, snd, this.fsButton('btn btn-ghost btn-sound btn-fs'), benchBtn);
    this.setOverlay(ov, 'title');
    window.setTimeout(() => start.focus({ preventScroll: true }), 60);
  }

  showPause(onResume: () => void, onRestart: () => void): void {
    const ov = el('div', 'overlay pause');
    const card = el('div', 'card');
    card.innerHTML = `<div class="kicker"><i></i><span>Привал</span><i></i></div><h2 class="card-title">Пауза</h2><p class="card-sub">Время стоит. Мороз подождёт.</p><div class="card-actions"></div>`;
    const acts = card.querySelector('.card-actions') as HTMLElement;
    const resume = this.btn('Продолжить', 'btn-primary', () => { onResume(); });
    let armed = false, tid = 0;
    const restart = this.btn('Начать заново', 'btn-ghost', () => {
      if (!armed) {
        armed = true;
        (restart.firstElementChild as HTMLElement).textContent = 'Точно? Прогресс пропадёт';
        restart.classList.add('armed');
        tid = window.setTimeout(() => { armed = false; restart.classList.remove('armed'); (restart.firstElementChild as HTMLElement).textContent = 'Начать заново'; }, 3000);
        return;
      }
      window.clearTimeout(tid);
      onRestart();
    });
    acts.append(resume, restart);

    // master volume: an instrument slider (range input styled as a fader), persisted
    const vol = el('div', 'vol');
    const pct0 = Math.round(this.volume * 100);
    vol.innerHTML = `<label class="vol-lab cap" for="vol-r">Громкость</label><input id="vol-r" class="vol-r" type="range" min="0" max="100" step="1" value="${pct0}" aria-label="Громкость"><output class="vol-val mono">${pct0}%</output>`;
    const vr = vol.querySelector('.vol-r') as HTMLInputElement, vo = vol.querySelector('.vol-val') as HTMLElement;
    const paintVol = () => { vr.style.setProperty('--p', vr.value + '%'); vo.textContent = vr.value + '%'; };
    paintVol();
    vr.addEventListener('input', () => {
      this.volume = Number(vr.value) / 100; paintVol();
      try { localStorage.setItem('frost.vol', String(this.volume)); } catch { /* storage unavailable */ }
      this.onVolume(this.volume);
    });
    vr.addEventListener('change', () => vr.blur());
    card.insertBefore(vol, acts.nextSibling);

    // physics comparison: kept on purpose, presented as a deliberate "laboratory" drawer (closed by default)
    const lab = el('section', 'lab');
    lab.setAttribute('aria-label', 'Лаборатория (физика тел)');
    const toggle = el('button', 'lab-toggle', `<i class="lab-line"></i>${ico('flask', 'lab-ico')}<span>Лаборатория (физика тел)</span>${ico('chev', 'lab-chev')}<i class="lab-line"></i>`);
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    const phys = el('div', 'plate phys');
    phys.hidden = true;
    phys.innerHTML = `
      <div class="phys-head"><span class="cap">Физика тел · Rapier 2D</span><i class="phys-led"></i></div>
      <div class="phys-row">
        <button type="button" class="pbtn pb-stress"><span class="pb-lab">Нагрузка</span><span class="pb-val">Сбросить 40 тел</span>${ico('put')}<kbd>K</kbd></button>
      </div>
      <p class="phys-info mono" aria-live="off"></p>
      <i class="rivet r1"></i><i class="rivet r2"></i><i class="rivet r3"></i><i class="rivet r4"></i>`;
    toggle.addEventListener('click', () => {
      const open = phys.hidden;
      phys.hidden = !open;
      lab.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.blur();
    });
    (phys.querySelector('.pb-stress') as HTMLButtonElement).addEventListener('click', (e) => { this.onStress(); (e.currentTarget as HTMLElement).blur(); });
    lab.append(toggle, phys);
    card.appendChild(lab);

    // performance test: a quiet instrument row right under the laboratory; two taps because the run replaces the current game
    const bt = el('button', 'bench-link', `<i class="lab-line"></i>${ico('timer', 'lab-ico')}<span>Тест производительности</span><i class="lab-line"></i>`);
    bt.type = 'button';
    let benchArmed = false, benchTid = 0;
    const benchLab = bt.querySelector('span') as HTMLElement;
    bt.addEventListener('click', () => {
      if (!benchArmed) {
        benchArmed = true; bt.classList.add('armed'); benchLab.textContent = 'Точно? Игра сбросится, ≈3 мин';
        benchTid = window.setTimeout(() => { benchArmed = false; bt.classList.remove('armed'); benchLab.textContent = 'Тест производительности'; }, 3500);
        return;
      }
      window.clearTimeout(benchTid);
      this.onBench(true);
    });
    card.appendChild(bt);

    ov.appendChild(card);
    this.setOverlay(ov, 'pause');
    this.physEls = { info: phys.querySelector('.phys-info') as HTMLElement };
    this.paintPhys();
    window.setTimeout(() => resume.focus({ preventScroll: true }), 60);
  }

  showEnd(win: boolean, cause: string, stats: { days: number; hours: number; built: string[] }, onRestart: () => void): void {
    const ov = el('div', `overlay end ${win ? 'win' : 'lose'}`);
    const card = el('div', 'card');
    const names = [...new Set(stats.built.map((b) => BUILT_NAME[b] ?? b))];
    const built = names.length
      ? `<ul class="built">${names.map(() => `<li></li>`).join('')}</ul>`
      : '<p class="built-none">Ничего не построено</p>';
    const two = (n: number) => String(Math.max(0, Math.round(n))).padStart(2, '0');
    const ro = (cap: string, val: number, unit: string) =>
      `<div class="ro"><span class="ro-cap">${cap}</span><b class="ro-val mono">${two(val)}</b><i class="ro-ticks"></i><span class="ro-unit">${unit}</span></div>`;
    card.innerHTML = `
      <div class="end-medal">${ico(win ? 'sun' : 'moon')}</div>
      <div class="kicker"><i></i><span>${win ? 'Рассвет' : 'Конец записей'}</span><i></i></div>
      <h2 class="card-title">${win ? 'Ты пережил три ночи' : 'Мгла победила'}</h2>
      <div class="note"><span class="note-tag">${win ? 'Запись' : 'Причина'}</span><p class="cause"></p><i class="note-ul"></i></div>
      <div class="stats">
        ${ro('Дни', stats.days, plural(stats.days, 'день', 'дня', 'дней'))}
        ${ro('В пути', stats.hours, plural(stats.hours, 'час', 'часа', 'часов'))}
        ${ro('Лагерь', names.length, plural(names.length, 'постройка', 'постройки', 'построек'))}
      </div>
      <div class="built-wrap"><span class="cap">Построено</span>${built}</div>
      <div class="card-actions"></div>`;
    // empty or placeholder cause ('тест') falls back to a proper line
    const raw = cause.trim();
    const junk = !raw || /^тест$/i.test(raw);
    const text = junk ? (win ? 'Солнце встало над плато. Огонь и укрытие выдержали.' : 'Мороз оказался сильнее.') : raw;
    (card.querySelector('.cause') as HTMLElement).textContent = text.charAt(0).toUpperCase() + text.slice(1);
    card.querySelectorAll('.built li').forEach((li, i) => { li.textContent = names[i]; });
    const again = this.btn('Ещё раз', 'btn-primary', () => { onRestart(); });
    (card.querySelector('.card-actions') as HTMLElement).appendChild(again);
    ov.appendChild(card);
    this.setOverlay(ov, 'end');
    window.setTimeout(() => again.focus({ preventScroll: true }), 400);
  }
}
